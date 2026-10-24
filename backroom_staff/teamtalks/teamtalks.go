// Package teamtalks renders a player's prompt files and keeps the exact copy
// that was sent. (Legacy: adw_modules/prompts.py.)
package teamtalks

import (
	"os"
	"path/filepath"
	"strings"
)

// Var is one {{name}} and the text that replaces it.
type Var struct {
	Name, Value string
}

// Render reads a template and replaces each {{name}} with its value, in the
// order given (legacy replaced in dict order, so a value that itself holds a
// later placeholder is replaced too; the order keeps that deterministic).
func Render(templatePath string, variables []Var) (string, error) {
	data, err := os.ReadFile(templatePath)
	if err != nil {
		return "", err
	}
	return RenderText(string(data), variables), nil
}

// RenderText replaces each {{name}} in text with its value, in order.
func RenderText(text string, variables []Var) string {
	for _, v := range variables {
		text = strings.ReplaceAll(text, "{{"+v.Name+"}}", v.Value)
	}
	return text
}

// Save writes the exact prompt sent, before it is sent: the audit copy.
func Save(directory, name, content string) (string, error) {
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(directory, name)
	return path, os.WriteFile(path, []byte(content), 0o644)
}
