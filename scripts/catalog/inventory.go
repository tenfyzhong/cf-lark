// Export build-time metadata from the pinned upstream module.
package main

import (
	"encoding/json"
	"os"
	"sort"

	"github.com/larksuite/cli/shortcuts"
)

type command struct {
	ID         string   `json:"id"`
	Identities []string `json:"identities"`
	Risk       string   `json:"risk"`
	UserScopes []string `json:"userScopes"`
	BotScopes  []string `json:"botScopes"`
	Flags      []string `json:"flags"`
	Hidden     bool     `json:"hidden"`
	Status     string   `json:"status"`
}

func main() {
	commands := make([]command, 0)
	for _, shortcut := range shortcuts.AllShortcuts() {
		flags := make([]string, 0, len(shortcut.Flags))
		for _, flag := range shortcut.Flags {
			flags = append(flags, flag.Name)
		}
		identities := shortcut.AuthTypes
		if len(identities) == 0 {
			identities = []string{"user"}
		}
		risk := shortcut.Risk
		if risk == "" {
			risk = "read"
		}
		commands = append(commands, command{
			ID:         shortcut.Service + "." + shortcut.Command,
			Identities: identities, Risk: risk,
			UserScopes: shortcut.ScopesForIdentity("user"),
			BotScopes:  shortcut.ScopesForIdentity("bot"),
			Flags:      flags, Hidden: shortcut.Hidden, Status: "pending",
		})
	}
	sort.Slice(commands, func(i, j int) bool { return commands[i].ID < commands[j].ID })
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(commands); err != nil {
		panic(err)
	}
}
