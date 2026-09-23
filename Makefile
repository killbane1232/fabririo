GO ?= go

.PHONY: run build test
run:
	$(GO) run ./cmd/fabririo

build:
	mkdir -p bin
	$(GO) build -buildvcs=false -trimpath -o bin/fabririo ./cmd/fabririo

test:
	$(GO) test ./...
