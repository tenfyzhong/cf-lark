// Preview metadata derived from lark-cli 1.0.97 (MIT).
export const previewTypes = [
    {
        "code": "0",
        "name": "PDF",
        "type": "pdf",
        "label": "PDF Preview",
        "aliases": []
    },
    {
        "code": "1",
        "name": "PNG",
        "type": "png",
        "label": "PNG Preview",
        "aliases": [
            "image"
        ]
    },
    {
        "code": "2",
        "name": "PAGES",
        "type": "pages",
        "label": "Paged Preview",
        "aliases": []
    },
    {
        "code": "3",
        "name": "VIDEO",
        "type": "video",
        "label": "Video Preview",
        "aliases": []
    },
    {
        "code": "4",
        "name": "MP4_360P",
        "type": "mp4_360p",
        "label": "MP4 360P Preview",
        "aliases": []
    },
    {
        "code": "5",
        "name": "MP4_480P",
        "type": "mp4_480p",
        "label": "MP4 480P Preview",
        "aliases": []
    },
    {
        "code": "6",
        "name": "MP4_720P",
        "type": "mp4_720p",
        "label": "MP4 720P Preview",
        "aliases": []
    },
    {
        "code": "7",
        "name": "JPG",
        "type": "jpg",
        "label": "JPG Preview",
        "aliases": [
            "image"
        ]
    },
    {
        "code": "8",
        "name": "HTML",
        "type": "html",
        "label": "HTML Preview",
        "aliases": []
    },
    {
        "code": "9",
        "name": "PDF_LIN",
        "type": "pdf_lin",
        "label": "Linearized PDF Preview",
        "aliases": []
    },
    {
        "code": "10",
        "name": "XOD",
        "type": "xod",
        "label": "XOD Preview",
        "aliases": []
    },
    {
        "code": "11",
        "name": "JPG_LIN",
        "type": "jpg_lin",
        "label": "Linearized JPG Preview",
        "aliases": [
            "image"
        ]
    },
    {
        "code": "12",
        "name": "PNG_LIN",
        "type": "png_lin",
        "label": "Linearized PNG Preview",
        "aliases": [
            "image"
        ]
    },
    {
        "code": "13",
        "name": "ARCHIVE",
        "type": "archive",
        "label": "Archive Preview",
        "aliases": []
    },
    {
        "code": "14",
        "name": "TEXT",
        "type": "text",
        "label": "Text Preview",
        "aliases": []
    },
    {
        "code": "15",
        "name": "PDF_PART",
        "type": "pdf_part",
        "label": "Partial PDF Preview",
        "aliases": []
    },
    {
        "code": "16",
        "name": "SOURCE_FILE",
        "type": "source_file",
        "label": "Source File",
        "aliases": [
            "source"
        ]
    },
    {
        "code": "17",
        "name": "VIDEO_META",
        "type": "video_meta",
        "label": "Video Metadata",
        "aliases": []
    },
    {
        "code": "18",
        "name": "WPS",
        "type": "wps",
        "label": "WPS Preview",
        "aliases": []
    },
    {
        "code": "19",
        "name": "SPLIT_PNG",
        "type": "split_png",
        "label": "Split PNG Preview",
        "aliases": [
            "image"
        ]
    },
    {
        "code": "20",
        "name": "MEDIA_RESULT",
        "type": "media_result",
        "label": "Media Result",
        "aliases": []
    },
    {
        "code": "21",
        "name": "MIME",
        "type": "mime",
        "label": "MIME Type",
        "aliases": []
    },
    {
        "code": "22",
        "name": "SPILT_IMG_TXT",
        "type": "spilt_img_txt",
        "label": "Split Image Text",
        "aliases": []
    },
    {
        "code": "23",
        "name": "MP4_1080P",
        "type": "mp4_1080p",
        "label": "MP4 1080P Preview",
        "aliases": []
    },
    {
        "code": "24",
        "name": "IMAGE_META",
        "type": "image_meta",
        "label": "Image Metadata",
        "aliases": []
    },
    {
        "code": "25",
        "name": "DOC_PART",
        "type": "doc_part",
        "label": "Document Part",
        "aliases": []
    },
    {
        "code": "26",
        "name": "WATERMARK_PDF",
        "type": "watermark_pdf",
        "label": "Watermarked PDF Preview",
        "aliases": []
    },
    {
        "code": "27",
        "name": "FILE_WATERMARK",
        "type": "file_watermark",
        "label": "File Watermark",
        "aliases": []
    }
];
export const previewStatuses = [
    {
        "code": "0",
        "name": "READY",
        "downloadable": true,
        "reason": ""
    },
    {
        "code": "1",
        "name": "PROCESSING",
        "downloadable": false,
        "reason": "Preview is still processing."
    },
    {
        "code": "2",
        "name": "FAILED",
        "downloadable": false,
        "reason": "Preview generation failed."
    },
    {
        "code": "3",
        "name": "FAILED_NOT_RETRY",
        "downloadable": false,
        "reason": "Preview generation failed and will not retry."
    },
    {
        "code": "4",
        "name": "INVALID_EXTENTION",
        "downloadable": false,
        "reason": "File extension is invalid for this preview type."
    },
    {
        "code": "5",
        "name": "FILE_TOO_LARGE",
        "downloadable": false,
        "reason": "File is too large for preview generation."
    },
    {
        "code": "6",
        "name": "EMPTY_FILE",
        "downloadable": false,
        "reason": "File is empty."
    },
    {
        "code": "7",
        "name": "NO_SUPPORT",
        "downloadable": false,
        "reason": "Preview is not supported for this file."
    },
    {
        "code": "8",
        "name": "INVALID_PREVIEW_TYPE",
        "downloadable": false,
        "reason": "Preview type is invalid."
    },
    {
        "code": "9",
        "name": "NEED_PASSWORD",
        "downloadable": false,
        "reason": "Preview requires a password."
    },
    {
        "code": "10",
        "name": "FILE_INVALID",
        "downloadable": false,
        "reason": "File is invalid."
    },
    {
        "code": "11",
        "name": "TOO_MANY_PAGES",
        "downloadable": false,
        "reason": "File has too many pages for preview."
    },
    {
        "code": "1001",
        "name": "ARCHIVE_INVALID_FORMAT",
        "downloadable": false,
        "reason": "Archive format is invalid."
    },
    {
        "code": "1002",
        "name": "ARCHIVE_TOO_MANY_NODES",
        "downloadable": false,
        "reason": "Archive contains too many nodes."
    },
    {
        "code": "1003",
        "name": "ARCHIVE_TOO_MANY_NODES_PER_DIR",
        "downloadable": false,
        "reason": "Archive directory contains too many nodes."
    },
    {
        "code": "1004",
        "name": "THIRD_ENC_NO_PERMISSION",
        "downloadable": false,
        "reason": "No permission for third-party encrypted file."
    },
    {
        "code": "1006",
        "name": "NOT_SUPPORT_DECRYPT_THIRD_ENC_FILE",
        "downloadable": false,
        "reason": "Third-party encrypted file cannot be decrypted for preview."
    }
];
