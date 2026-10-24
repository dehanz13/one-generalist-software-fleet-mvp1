// Package templates holds what `ogsf incorporate` stamps into a repository:
// the club config, the team talks, the enchantments, the spec tools' helpers
// and the .env sample. They are built into the binary, so a fresh Mac needs
// nothing but `ogsf`.
package templates

import "embed"

// FS is the template tree: set_pieces/… and env.sample.
//
//go:embed all:set_pieces env.sample
var FS embed.FS
