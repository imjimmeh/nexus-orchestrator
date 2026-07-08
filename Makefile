.PHONY: build build-heavy build-light build-claude-code build-compose clean

build: build-heavy build-light build-claude-code build-compose

# Heavy image: carries the PI runner. Tagged with the legacy name (used by
# chat-execution and as the workflow fallback) and the harness registry's
# default PI image ref so harness steps resolve it without env overrides.
build-heavy:
	docker build -f docker/Dockerfile.heavy -t nexus-heavy:latest -t nexus/harness-pi:latest .

# Light image: lightweight container for non-harness tasks (e.g. simple bash scripts).
build-light:
	docker build -f docker/Dockerfile.light -t nexus-light:latest .

# Claude Code harness runner: harness registry default image ref.
build-claude-code:
	docker build -f docker/Dockerfile.claude-code -t nexus/harness-claude-code:latest .

build-compose:
	docker-compose build

clean:
	docker compose down --rmi local
