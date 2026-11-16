# @wasm-gaming/sonic3air-wasm — build & preview
#
#   make build           The package: upstream engine + SDK + app + demo → dist/
#   make build-upstream  The official web build, pinned and SHA-256-checked → dist/sonic3air/
#   make build-sdk       TypeScript + the contract runtime + the app + the demo (no download)
#   make test            Type-check, then the tests against the built package
#   make smoke           Headless Chromium boot with a real ROM (ROM=path/to/Sonic_Knuckles_wSonic3.bin)
#   make preview         Serve dist/ with COOP/COEP
#
# Nothing is compiled from C++: the engine is Eukaryot's own release (see
# scripts/fetch-upstream.mjs). All build logic lives here (package.json has no scripts).

BIN := node_modules/.bin
PORT ?= 8040
SPECS := node_modules/@wasm-gaming/engine-specs

.PHONY: build build-upstream build-sdk build-lib build-specs build-app build-demo \
	typecheck test smoke release-check preview i install clean help

i: install
install: ## Install dependencies
	npm install

node_modules: package.json
	npm install
	@touch node_modules

build: build-upstream build-sdk ## The package and the demo → dist/

build-upstream: ## Download the pinned official web build, check it, wrap its JS → dist/sonic3air/
	node scripts/fetch-upstream.mjs dist/sonic3air

build-sdk: build-lib build-specs build-app build-demo ## The published SDK: TypeScript + contract runtime + app, and the demo pages

build-lib: node_modules ## Compile SDK + options → dist/sonic3air/
	$(BIN)/tsc -p tsconfig.json

build-specs: build-lib ## Ship the contract runtime beside the SDK and import it relatively
	# The SDK extends the contract's base classes, so engine-specs is a runtime
	# import. Copied into dist/sonic3air/ (inside `files`) and the emitted imports
	# rewritten to it: the package loads from any static server, no import map.
	cp $(SPECS)/dist/engine-specs.js dist/sonic3air/engine-specs.js
	node scripts/localize-specs.mjs dist/sonic3air

build-app: ## The engine's own app (boot + pause menu) → dist/sonic3air/app/
	# Plain JS + CSS, imported by hosts as <engine>/app/app.js (EngineApp). It loads
	# the SDK next to it relatively.
	rm -rf dist/sonic3air/app
	mkdir -p dist/sonic3air/app
	cp src/app/app.js src/app/app.css dist/sonic3air/app/
	# The licence travels with the binary, in every archive and in the npm package.
	cp LICENSE THIRD_PARTY_NOTICES.md dist/sonic3air/

build-demo: ## The no-build demo pages → dist/index.html, dist/app.html
	cp src/demo/index.html src/demo/app.html dist/

typecheck: node_modules ## Type-check the SDK
	$(BIN)/tsc -p tsconfig.json --noEmit

test: typecheck build-sdk ## Type-check, then run tests/ against the built package
	node --test tests/*.test.mjs

smoke: ## Boot in headless Chromium with a real ROM (needs make build and ROM=…)
	node scripts/smoke-test.cjs

release-check: build-sdk test ## npm pack preview
	npm config get registry
	npm pack --dry-run

preview: ## Serve dist/ with COOP/COEP headers
	@echo "Serving dist/ at http://localhost:$(PORT) (Ctrl+C to stop)"
	python3 scripts/preview-server.py --port $(PORT) --directory dist

clean: ## Remove build outputs
	@if [ -d dist ]; then find dist -mindepth 1 -delete; fi

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
