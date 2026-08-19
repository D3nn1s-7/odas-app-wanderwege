#
# ODAS Generic App
# (C) Ondics, 2026
#

# aktuelles Dir ist docker-compose project name
mkfile_path := $(abspath $(lastword $(MAKEFILE_LIST)))
current_dir := $(notdir $(patsubst %/,%,$(dir $(mkfile_path))))

DC_BIN = docker compose
DC_FILES = -f docker-compose.yml
ifeq ($(STANDALONE),true)
DC_FILES := ${DC_FILES} -f docker-compose.standalone.yml
endif

DC_PROJECT = ${current_dir}
DC = ${DC_BIN} ${DC_FILES}

# für Backups...
#DATE := $(shell date '+%Y%m%d-%H%M%S')
DATE := $(shell date '+%Y%m%d')

# help-systematik
# build muss phony sein (forcierter build), weil es
# als verzeichnis existiert und sonst nie gebaut werden w�rde
.PHONY: help build stats

help:
	@echo "# ODAS Generic App"
	@echo "# Ondics, 2026"
	@echo "# dir = ${current_dir}"
	@echo Befehle: make ...
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.DEFAULT_GOAL := help

# allgemeine Befehle
up: ## App starten (Standalone mit STANDALONE=true)
	${DC} up -d --build --remove-orphans

down: ## App stoppen (Standalone mit STANDALONE=true)
	${DC} down

down-volumes: ## Container stopen, Volumes löschen
	${DC} down --volumes

logs: ## Show logs of all containers (stop with ctrl-c)
	${DC} logs -f -t --tail=100

build:  ## Build all containers
	${DC} build

bash: ## Bash in frontend-container
	${DC} exec oda-app sh

ps: ## what's up?
	${DC} ps

config: ## show docker-compose config 
	${DC} config

zip: ## App zur Auslieferung vorbereiten
	zip -r ${current_dir}.zip \
	 	app assets app-package.json CHANGELOG.md

check-app: ## App prüfen mit Skript aus ODAS-Tools
	echo "App prüfen"
	./../odas-tools/app-check.sh