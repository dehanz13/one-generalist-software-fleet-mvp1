# One Generalist Software Fleet: build, test and package.
#
#   make            test everything, then build ./bin/ogsf with the page inside
#   make ui         build Matchday Live and copy it into the binary's embed folder
#   make demo-data  regenerate the demo recording Matchday Live replays
#   make test       go vet + go test, and the page's typecheck + tests

GO        ?= go
VERSION   ?= $(shell git describe --tags --always 2>/dev/null || echo dev)
UI        := matchday_live
EMBED     := backroom_staff/matchday/dist
DEMO_DATA := $(UI)/public/demo/matchday-demo.json

.PHONY: all build ui demo-data test test-go test-ui clean

all: test build

build:
	$(GO) build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o bin/ogsf ./cmd/ogsf

ui:
	cd $(UI) && npm ci && npm run build
	rm -rf $(EMBED) && mkdir -p $(EMBED) && cp -R $(UI)/dist/. $(EMBED)/

# A fixed start and neutral paths keep the recording reproducible and free of
# anything machine-specific.
demo-data:
	$(GO) build -o bin/ogsf ./cmd/ogsf
	rm -rf /tmp/ogsf-demo-recording
	TMPDIR=/tmp ./bin/ogsf demo --dir /tmp/ogsf-demo-recording --start 2026-10-12T13:50:00Z --export $(DEMO_DATA)

test: test-go test-ui

test-go:
	$(GO) vet ./...
	$(GO) test ./...

test-ui:
	cd $(UI) && npm run typecheck && npm test

clean:
	rm -rf bin $(UI)/dist
