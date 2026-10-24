package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/incorporate"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/spectools"
	setpieces "github.com/dehanz13/one-generalist-software-fleet-mvp1/set_pieces"
)

func setupCommands() []*cobra.Command {
	var force bool
	inc := &cobra.Command{
		Use: "incorporate", GroupID: "setup",
		Short: "put the fleet into this repository: config, team talks, enchantments, .env.sample, .gitignore",
		RunE: func(cmd *cobra.Command, args []string) error {
			root, err := os.Getwd()
			if err != nil {
				return err
			}
			result, err := incorporate.Incorporate(root, force)
			if err != nil {
				return err
			}
			incorporate.Report(os.Stdout, root, result)
			return nil
		},
	}
	inc.Flags().BoolVar(&force, "force", false, "overwrite existing files")

	var forceConfig bool
	onboard := &cobra.Command{
		Use: "onboard", GroupID: "setup",
		Short: "write set_pieces/boardroom/club.config.yaml with the fleet's defaults",
		RunE: func(cmd *cobra.Command, args []string) error {
			root, err := os.Getwd()
			if err != nil {
				return err
			}
			path, err := incorporate.Onboard(root, forceConfig)
			if err != nil {
				return err
			}
			fmt.Println("wrote", path)
			return nil
		},
	}
	onboard.Flags().BoolVar(&forceConfig, "force", false, "overwrite an existing config")

	var name, players string
	var forceBook bool
	playbook := &cobra.Command{
		Use: "write-playbook", GroupID: "setup",
		Short: "write a playbook: a chain of players run by `ogsf play <name>`",
		RunE: func(cmd *cobra.Command, args []string) error {
			var list []string
			for _, p := range strings.Split(players, ",") {
				if p = strings.TrimSpace(p); p != "" {
					list = append(list, p)
				}
			}
			path, err := setpieces.WritePlaybook(name, list, forceBook)
			if err != nil {
				return err
			}
			fmt.Println("wrote", path)
			fmt.Println("next: replace each step's description — a generated one says nothing, and the description is the only intent the record ever shows")
			fmt.Printf("run: ogsf play %s \"your request\"\n", name)
			return nil
		},
	}
	playbook.Flags().StringVar(&name, "name", "", "snake_case playbook name")
	playbook.Flags().StringVar(&players, "players", "", "comma-separated players, in order")
	playbook.Flags().BoolVar(&forceBook, "force", false, "overwrite an existing playbook")
	_ = playbook.MarkFlagRequired("name")
	_ = playbook.MarkFlagRequired("players")
	return []*cobra.Command{inc, onboard, playbook}
}

func specCommands() []*cobra.Command {
	pass := func(use, short string, run func([]string, *os.File, *os.File) int) *cobra.Command {
		return &cobra.Command{
			Use: use, Short: short, GroupID: "spec", DisableFlagParsing: true,
			RunE: func(cmd *cobra.Command, args []string) error {
				if code := run(args, os.Stdout, os.Stderr); code != 0 {
					return exitError{code}
				}
				return nil
			},
		}
	}
	return []*cobra.Command{
		pass("spec-area --name <slug> --label \"<label>\" [--only-with-errors] <paths>…",
			"write a test-lint quest spec from measurements (ESLint, Vitest, Jest)",
			func(a []string, o, e *os.File) int { return spectools.AreaSpec(a, o, e) }),
		pass("spec-types --src <ts4111.json> --name <slug> --label \"<label>\" [--pilot] <paths>…",
			"write a typed-records quest spec from ts4111_sources.cjs output",
			func(a []string, o, e *os.File) int { return spectools.TypeSpec(a, o, e) }),
		pass("fire-drill --base <ref> [--jest] <breaks.yaml>",
			"break the code under test and see whether the old or new tests notice",
			func(a []string, o, e *os.File) int { return spectools.FireDrill(a, o, e) }),
		pass("shape-search \"<label>=<range>\"…",
			"list places in test diffs with a shape a review has found weakening before",
			func(a []string, o, e *os.File) int { return spectools.ShapeSearch(a, o, e) }),
	}
}
