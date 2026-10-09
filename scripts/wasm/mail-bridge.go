package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/mail"
	"regexp"
	"strings"
	"syscall/js"
	"time"

	"github.com/larksuite/cli/extension/fileio"
	"github.com/larksuite/cli/shortcuts/mail/draft"
	"github.com/larksuite/cli/shortcuts/mail/emlbuilder"
	"github.com/larksuite/cli/shortcuts/mail/filecheck"
	"github.com/larksuite/cli/shortcuts/mail/ics"
	"github.com/larksuite/cli/shortcuts/mail/lint"
)

var mailHTMLPattern = regexp.MustCompile(`(?i)<(?:!doctype\s+html|!--|html|head|body|div|p|br|span|a|b|i|em|strong|h[1-6]|ul|ol|li|table|tr|td|th|img|font|style|script|iframe|title|form|input|select|textarea|button|label|blockquote|pre|code|hr|section|article|header|footer|nav|main)[\s/>]`)

type mailAddress struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}
type mailPart struct {
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
	CID         string `json:"cid"`
	Data        []byte `json:"data"`
}
type mailMemoryFS map[string][]byte
type mailMemoryFile struct{ *bytes.Reader }

func (f mailMemoryFile) Close() error { return nil }

type mailMemoryInfo int64

func (f mailMemoryInfo) Size() int64       { return int64(f) }
func (f mailMemoryInfo) IsDir() bool       { return false }
func (f mailMemoryInfo) Mode() fs.FileMode { return 0400 }
func (files mailMemoryFS) Open(name string) (fileio.File, error) {
	value, ok := files[name]
	if !ok {
		return nil, fmt.Errorf("artifact input missing: %s", name)
	}
	return mailMemoryFile{bytes.NewReader(value)}, nil
}
func (files mailMemoryFS) Stat(name string) (fileio.FileInfo, error) {
	value, ok := files[name]
	if !ok {
		return nil, fmt.Errorf("artifact input missing: %s", name)
	}
	return mailMemoryInfo(len(value)), nil
}
func (files mailMemoryFS) ResolvePath(string) (string, error) {
	return "", fmt.Errorf("filesystem paths are unavailable")
}
func (files mailMemoryFS) Save(string, fileio.SaveOptions, io.Reader) (fileio.SaveResult, error) {
	return nil, fmt.Errorf("filesystem writes are unavailable")
}

func checkMailHTMLComplexity(value string) error {
	if len(value)+strings.Count(value, "<")*256 > 8*1024*1024 {
		return fmt.Errorf("mail text/HTML complexity exceeds the hosted 8 MiB combined text and markup budget")
	}
	return nil
}

func normalizeMailParts(part *draft.Part) {
	if part == nil {
		return
	}
	if strings.HasPrefix(part.MediaType, "multipart/") && part.MediaParams == nil {
		part.MediaParams = map[string]string{}
	}
	for _, child := range part.Children {
		normalizeMailParts(child)
	}
}

func mailOperation(raw string) (result any, err error) {
	defer func() {
		if failure := recover(); failure != nil {
			result = nil
			err = fmt.Errorf("mail transformation failed: %v", failure)
		}
	}()
	var input struct {
		Action        string          `json:"action"`
		Template      templatePayload `json:"template"`
		SignatureID   string          `json:"signature_id"`
		SignatureHTML string          `json:"signature_html"`
		Brand         string          `json:"brand"`
		Large         []struct {
			Name  string `json:"name"`
			Size  int64  `json:"size"`
			Token string `json:"token"`
		} `json:"large"`
		OriginalMillis      int64              `json:"original_millis"`
		ReadTime            string             `json:"read_time"`
		Operation           string             `json:"operation"`
		Body                string             `json:"body"`
		Raw                 string             `json:"raw"`
		DraftID             string             `json:"draft_id"`
		From                mailAddress        `json:"from"`
		To                  []mailAddress      `json:"to"`
		CC                  []mailAddress      `json:"cc"`
		BCC                 []mailAddress      `json:"bcc"`
		Subject             string             `json:"subject"`
		Text                string             `json:"text"`
		HTML                string             `json:"html"`
		Calendar            string             `json:"calendar"`
		InReplyTo           string             `json:"in_reply_to"`
		LMSReplyTo          string             `json:"lms_reply_to"`
		References          string             `json:"references"`
		RequestReceipt      bool               `json:"request_receipt"`
		IsReceipt           bool               `json:"is_receipt"`
		AllowNoRecipients   bool               `json:"allow_no_recipients"`
		Headers             map[string]string  `json:"headers"`
		Attachments         []mailPart         `json:"attachments"`
		Inline              []mailPart         `json:"inline"`
		Files               map[string][]byte  `json:"files"`
		Patch               draft.Patch        `json:"patch"`
		CalendarByOp        map[int]string     `json:"calendar_by_op"`
		SignatureImagesByOp map[int][]mailPart `json:"signature_images_by_op"`
		SignatureByOp       map[int]string     `json:"signature_by_op"`
		Event               struct {
			Summary  string `json:"summary"`
			Location string `json:"location"`
			Start    string `json:"start"`
			End      string `json:"end"`
			UID      string `json:"uid"`
		} `json:"event"`
		Addresses string `json:"addresses"`
		UseHTML   bool   `json:"use_html"`
		Forward   bool   `json:"forward"`
		Original  struct {
			Subject string        `json:"subject"`
			From    mailAddress   `json:"from"`
			To      []mailAddress `json:"to"`
			CC      []mailAddress `json:"cc"`
			Body    string        `json:"body"`
			Date    string        `json:"date"`
		} `json:"original"`
	}
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		return nil, err
	}
	switch input.Operation {
	case "template-body":
		return mergeTemplateBody(templateShortcutKind(input.Action), &input.Template, input.Body, ""), nil
	case "signature-body":
		return draft.PlaceSignatureBeforeSystemTail(input.Body, draft.SignatureSpacing()+draft.BuildSignatureHTML(input.SignatureID, input.SignatureHTML)), nil
	case "large-attachments":
		items := []largeAttachmentResult{}
		ids := []map[string]string{}
		for _, a := range input.Large {
			items = append(items, largeAttachmentResult{FileName: a.Name, FileSize: a.Size, FileToken: a.Token})
			ids = append(ids, map[string]string{"id": a.Token})
		}
		encoded, _ := json.Marshal(ids)
		html := buildLargeAttachmentHTML(input.Brand, "en", items)
		if input.UseHTML {
			html = draft.InsertBeforeQuoteOrAppend(input.Body, html)
		}
		return map[string]any{"html": html, "text": buildLargeAttachmentPlainText(input.Brand, "en", items), "header": base64.StdEncoding.EncodeToString(encoded)}, nil
	case "receipt":
		now := time.Now()
		if input.ReadTime != "" {
			value, err := time.Parse(time.RFC3339, input.ReadTime)
			if err != nil {
				return nil, err
			}
			now = value
		}
		lang := detectSubjectLang(input.Subject)
		return map[string]any{"subject": buildReceiptSubject(input.Subject), "text": buildReceiptTextBody(lang, input.Subject, input.From.Address, input.OriginalMillis, now), "html": buildReceiptHTMLBody(lang, input.Subject, input.From.Address, input.OriginalMillis, now)}, nil
	case "quote":
		original := originalMessage{subject: input.Original.Subject, headFrom: input.Original.From.Address, headFromName: input.Original.From.Name, bodyRaw: input.Original.Body, headDate: input.Original.Date}
		for _, a := range input.Original.To {
			original.toAddresses = append(original.toAddresses, a.Address)
			original.toAddressesFull = append(original.toAddressesFull, mailAddressPair{Email: a.Address, Name: a.Name})
		}
		for _, a := range input.Original.CC {
			original.ccAddresses = append(original.ccAddresses, a.Address)
			original.ccAddressesFull = append(original.ccAddressesFull, mailAddressPair{Email: a.Address, Name: a.Name})
		}
		subject := buildReplySubject(original.subject)
		var quote string
		if input.Forward {
			subject = buildForwardSubject(original.subject)
			if input.UseHTML {
				quote = buildForwardQuoteHTML(&original)
			} else {
				quote = buildForwardedMessage(&original, "")
			}
		} else {
			stripLargeAttachmentCard(&original)
			quote = quoteForReply(&original, input.UseHTML)
		}
		return map[string]any{"subject": subject, "quote": quote}, nil
	case "addresses":
		if input.Addresses == "" {
			return []mailAddress{}, nil
		}
		parsed, err := mail.ParseAddressList(input.Addresses)
		if err != nil {
			return nil, err
		}
		out := []mailAddress{}
		for _, a := range parsed {
			out = append(out, mailAddress{Name: a.Name, Address: a.Address})
		}
		return out, nil
	case "is-html":
		return mailHTMLPattern.MatchString(input.Body), nil
	case "plain-text":
		return draft.PlainTextFromHTML(input.Body), nil
	case "lint":
		if !mailHTMLPattern.MatchString(input.Body) {
			return lint.EmptyReport(input.Body), nil
		}
		return lint.Run(input.Body, lint.Options{}), nil
	case "calendar":
		start, err := time.Parse(time.RFC3339, input.Event.Start)
		if err != nil {
			return nil, err
		}
		end, err := time.Parse(time.RFC3339, input.Event.End)
		if err != nil {
			return nil, err
		}
		if !end.After(start) {
			return nil, fmt.Errorf("event end must be after start")
		}
		event := ics.Event{UID: input.Event.UID, Summary: input.Event.Summary, Location: input.Event.Location, Start: start, End: end, Organizer: ics.Address{Name: input.From.Name, Email: input.From.Address}}
		for _, a := range append(input.To, input.CC...) {
			event.Attendees = append(event.Attendees, ics.Address{Name: a.Name, Email: a.Address})
		}
		return string(ics.Build(event)), nil
	case "build-eml":
		builder := emlbuilder.New().Subject(input.Subject)
		if input.From.Address != "" {
			builder = builder.From(input.From.Name, input.From.Address)
		}
		for _, a := range input.To {
			builder = builder.To(a.Name, a.Address)
		}
		for _, a := range input.CC {
			builder = builder.CC(a.Name, a.Address)
		}
		for _, a := range input.BCC {
			builder = builder.BCC(a.Name, a.Address)
		}
		if input.AllowNoRecipients {
			builder = builder.AllowNoRecipients()
		}
		if input.RequestReceipt {
			builder = builder.DispositionNotificationTo(input.From.Name, input.From.Address)
		}
		if input.IsReceipt {
			builder = builder.IsReadReceiptMail(true)
		}
		if input.InReplyTo != "" {
			builder = builder.InReplyTo(input.InReplyTo)
		}
		if input.LMSReplyTo != "" {
			builder = builder.LMSReplyToMessageID(input.LMSReplyTo)
		}
		if input.References != "" {
			builder = builder.References(input.References)
		}
		if input.Text != "" {
			builder = builder.TextBody([]byte(input.Text))
		}
		if input.HTML != "" {
			builder = builder.HTMLBody([]byte(input.HTML))
		}
		if input.Calendar != "" {
			builder = builder.CalendarBody([]byte(input.Calendar))
		}
		for k, v := range input.Headers {
			builder = builder.Header(k, v)
		}
		for _, part := range input.Attachments {
			if err := filecheck.CheckBlockedExtension(part.Name); err != nil {
				return nil, err
			}
			builder = builder.AddAttachment(part.Data, part.ContentType, part.Name)
		}
		for _, part := range input.Inline {
			if _, err := filecheck.CheckInlineImageFormat(part.Name, part.Data); err != nil {
				return nil, err
			}
			builder = builder.AddInline(part.Data, part.ContentType, part.Name, part.CID)
		}
		result, err := builder.BuildBase64URL()
		if err != nil {
			return nil, err
		}
		return map[string]any{"raw": result}, nil
	case "validate-patch":
		return input.Patch.Summary(), input.Patch.Validate()
	case "patch-template":
		return buildDraftEditPatchTemplate(), nil
	case "inspect-eml", "edit-eml":
		snapshot, err := draft.Parse(draft.DraftRaw{DraftID: input.DraftID, RawEML: input.Raw})
		if err != nil {
			return nil, err
		}
		if html := draft.FindHTMLBodyPart(snapshot.Body); html != nil {
			if err := checkMailHTMLComplexity(string(html.Body)); err != nil {
				return nil, err
			}
		}

		if input.Operation == "edit-eml" {
			ensureLargeAttachmentCards(input.Brand, snapshot)
			normalizeLargeAttachmentHeader(snapshot)
			if len(input.Large) > 0 {
				items := []largeAttachmentResult{}
				ids := []largeAttID{}
				for _, h := range snapshot.Headers {
					if draft.IsLargeAttachmentHeader(h.Name) {
						decoded, _ := base64.StdEncoding.DecodeString(h.Value)
						json.Unmarshal(decoded, &ids)
					}
				}
				for _, a := range input.Large {
					items = append(items, largeAttachmentResult{FileName: a.Name, FileSize: a.Size, FileToken: a.Token})
					ids = append(ids, largeAttID{ID: a.Token})
				}
				if draft.FindHTMLBodyPart(snapshot.Body) != nil {
					injectLargeAttachmentHTMLIntoSnapshot(snapshot, input.Brand, "en", items)
				} else if draft.FindTextBodyPart(snapshot.Body) != nil {
					injectLargeAttachmentTextIntoSnapshot(snapshot, buildLargeAttachmentPlainText(input.Brand, "en", items))
				} else {
					return nil, fmt.Errorf("large attachments require a draft body")
				}
				encoded, _ := json.Marshal(ids)
				headers := []draft.Header{}
				for _, h := range snapshot.Headers {
					if !draft.IsLargeAttachmentHeader(h.Name) {
						headers = append(headers, h)
					}
				}
				snapshot.Headers = append(headers, draft.Header{Name: draft.LargeAttachmentIDsHeader, Value: base64.StdEncoding.EncodeToString(encoded)})
			}
			for index, op := range input.Patch.Ops {
				if op.Op != "set_calendar" {
					continue
				}
				if existing := draft.FindPartByMediaType(snapshot.Body, "text/calendar"); existing != nil {
					event := ics.ParseEvent(string(existing.Body))
					if event == nil || !event.IsLarkDraft {
						return nil, fmt.Errorf("calendar event has already been created and is read-only; remove it before creating a replacement")
					}
				}
				start, err := time.Parse(time.RFC3339, op.EventStart)
				if err != nil {
					return nil, err
				}
				end, err := time.Parse(time.RFC3339, op.EventEnd)
				if err != nil {
					return nil, err
				}
				if !end.After(start) {
					return nil, fmt.Errorf("event end must be after start")
				}
				to, cc := effectiveRecipients(snapshot, input.Patch.Ops)
				event := ics.Event{Summary: op.EventSummary, Location: op.EventLocation, Start: start, End: end}
				if len(snapshot.From) > 0 {
					event.Organizer = ics.Address{Name: snapshot.From[0].Name, Email: snapshot.From[0].Address}
				}
				for _, a := range append(to, cc...) {
					event.Attendees = append(event.Attendees, ics.Address{Name: a.Name, Email: a.Address})
				}
				input.Patch.Ops[index].CalendarICS = ics.Build(event)
			}
			for index, images := range input.SignatureImagesByOp {
				if index >= 0 && index < len(input.Patch.Ops) {
					for _, img := range images {
						input.Patch.Ops[index].SignatureImages = append(input.Patch.Ops[index].SignatureImages, draft.SignatureImage{CID: img.CID, FileName: img.Name, ContentType: img.ContentType, Data: img.Data})
					}
				}
			}
			for index, value := range input.CalendarByOp {
				if index >= 0 && index < len(input.Patch.Ops) {
					input.Patch.Ops[index].CalendarICS = []byte(value)
				}
			}
			for index, value := range input.SignatureByOp {
				if index >= 0 && index < len(input.Patch.Ops) {
					input.Patch.Ops[index].RenderedSignatureHTML = value
				}
			}
			if len(input.Patch.Ops) > 0 {
				if err = draft.Apply(&draft.DraftCtx{FIO: mailMemoryFS(input.Files)}, snapshot, input.Patch); err != nil {
					return nil, err
				}
			}
		}
		if html := draft.FindHTMLBodyPart(snapshot.Body); html != nil {
			if err := checkMailHTMLComplexity(string(html.Body)); err != nil {
				return nil, err
			}
		}
		normalizeMailParts(snapshot.Body)
		result, err := draft.Serialize(snapshot)
		if err != nil {
			return nil, err
		}
		return map[string]any{"raw": result, "projection": draft.Project(snapshot), "from": snapshot.From, "base_size": snapshotEMLBaseSize(snapshot)}, nil
	}
	return nil, fmt.Errorf("unsupported mail transformation operation")
}

func init() {
	js.Global().Set("cfLarkMail", js.FuncOf(func(_ js.Value, args []js.Value) any {
		result, err := mailOperation(args[0].String())
		envelope := map[string]any{"result": result}
		if err != nil {
			envelope = map[string]any{"error": err.Error()}
		}
		encoded, err := json.Marshal(envelope)
		if err != nil {
			return `{"error":"Mail transformation response serialization failed"}`
		}
		return string(encoded)
	}))
}
