package spectools

import (
	"reflect"
	"testing"
)

func TestGlobEscapeIsPythons(t *testing.T) {
	for in, want := range map[string]string{
		"app/r/[code]/page.test.tsx": "app/r/[[]code]/page.test.tsx",
		"a*b?c":                      "a[*]b[?]c",
		"plain/path.ts":              "plain/path.ts",
		"x]y":                        "x]y",
	} {
		if got := GlobEscape(in); got != want {
			t.Errorf("GlobEscape(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFnmatchIsPythons(t *testing.T) {
	cases := []struct {
		name, pattern string
		want          bool
	}{
		{"components/contact/nested/deep/Thing.test.tsx", "components/contact/*", true}, // * crosses /
		{"a/b.ts", "a/?.ts", true},
		{"a/bb.ts", "a/?.ts", false},
		{"c", "[abc]", true},
		{"d", "[abc]", false},
		{"d", "[!abc]", true},
		{"m", "[a-z]", true},
		{"M", "[a-z]", false},
		{"]", "[]]", true},
		{"[x", "[x", true}, // an unclosed bracket is literal
		{"a.b", "a.b", true},
		{"axb", "a.b", false}, // a dot is a dot
		{"app/r/[code]/page.test.tsx", "app/r/[[]code]/page.test.tsx", true},
		{"app/r/c/page.test.tsx", "app/r/[code]/page.test.tsx", true}, // the trap GlobEscape closes
		{"(platform)/x", "(platform)/*", true},
		{"a+b", "a+b", true},
	}
	for _, c := range cases {
		if got := Fnmatch(c.name, c.pattern); got != c.want {
			t.Errorf("Fnmatch(%q, %q) = %v, want %v", c.name, c.pattern, got, c.want)
		}
	}
}

func TestCounterBreaksTiesLikePython(t *testing.T) {
	c := CounterOf(KV{"b", 1}, KV{"a", 2}, KV{"c", 1})
	c.Update(CounterOf(KV{"c", 1}, KV{"d", 2}))
	want := []KV{{"a", 2}, {"c", 2}, {"d", 2}, {"b", 1}}
	if got := c.MostCommon(); !reflect.DeepEqual(got, want) {
		t.Fatalf("MostCommon = %v, want %v", got, want)
	}
	if c.Total() != 7 || c.Get("zz") != 0 || !c.Has("b") {
		t.Fatalf("Total/Get/Has wrong: %d", c.Total())
	}
}

func TestArgsReadFlagsAnywhereLikeArgparse(t *testing.T) {
	a, err := parseArgs([]string{"x", "--name", "n", "y", "--label=l", "--only-with-errors", "z"},
		[]string{"name", "label"}, []string{"only-with-errors"})
	if err != nil {
		t.Fatal(err)
	}
	if a.values["name"] != "n" || a.values["label"] != "l" || !a.bools["only-with-errors"] ||
		!reflect.DeepEqual(a.positionals, []string{"x", "y", "z"}) {
		t.Fatalf("parsed %+v", a)
	}
	if _, err := parseArgs([]string{"--nope"}, nil, nil); err == nil {
		t.Fatal("an unknown flag must be refused")
	}
	if _, err := parseArgs([]string{"--name"}, []string{"name"}, nil); err == nil {
		t.Fatal("a flag without its value must be refused")
	}
	if err := a.require("name", "missing"); err == nil {
		t.Fatal("a missing required flag must be named")
	}
}
