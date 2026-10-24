package matchfeed

import (
	"os"
	"path/filepath"
	"testing"
)

func TestARequestOnlyMovesForwardAndIsClaimedOnce(t *testing.T) {
	feed, err := Open(filepath.Join(t.TempDir(), "match_log.db"), os.DevNull, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer feed.Close()
	forOther, _ := feed.RequestCreate(RequestRow{RequestedBy: "cli", Kind: "set_piece", SetPiece: "ask", Prompt: "a", Machine: "other-mac"})
	first, _ := feed.RequestCreate(RequestRow{RequestedBy: "cli", Kind: "set_piece", SetPiece: "ask", Prompt: "b"})
	claimed, err := feed.RequestClaim("mac")
	if err != nil || claimed == nil || claimed.RequestID != first.RequestID || claimed.Status != "claimed" || claimed.ClaimedBy != "mac" {
		t.Fatalf("claim skips another Mac's request: %+v %v", claimed, err)
	}
	if again, _ := feed.RequestClaim("mac"); again != nil {
		t.Fatalf("nothing left for this Mac: %+v", again)
	}
	if err := feed.RequestUpdate(first.RequestID, "queued", "", ""); err == nil {
		t.Fatal("a request never moves back")
	}
	if err := feed.RequestUpdate(first.RequestID, "running", "m1", ""); err != nil {
		t.Fatal(err)
	}
	if err := feed.RequestUpdate(first.RequestID, "touchdown", "", ""); err != nil {
		t.Fatal(err)
	}
	if got, _ := feed.Request(first.RequestID); got.Status != "touchdown" || got.MatchID != "m1" {
		t.Fatalf("a later update keeps the match: %+v", got)
	}
	if err := feed.RequestUpdate(first.RequestID, "turnover", "", ""); err == nil {
		t.Fatal("a settled request stays settled")
	}
	if _, err := feed.RequestCancel(first.RequestID); err == nil {
		t.Fatal("only a queued request can be cancelled")
	}
	if got, err := feed.RequestCancel(forOther.RequestID); err != nil || got.Status != "cancelled" {
		t.Fatalf("cancel: %+v %v", got, err)
	}
}
