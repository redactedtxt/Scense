.PHONY: dev test pipeline tune migrate lint

# Start Postgres, the API, and the web app. Ctrl+C stops them.
dev:
	docker compose up --build

# Run API, web, and pipeline tests.
test:
	cd api && npm test
	cd web && npm test
	cd pipeline && python -m pytest

lint:
	cd api && npm run lint
	cd web && npm run lint
	cd pipeline && python -m ruff check .

# Apply SQL migrations in db/migrations (needs `make dev` running).
migrate:
	docker compose exec api npm run migrate

pipeline:
	@echo "pipeline: not built yet (M2)"

tune:
	@echo "tune: not built yet (M2)"
