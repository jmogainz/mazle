# ----------------------
# Help Target
# ----------------------

SHELL := /bin/bash

.PHONY: help

INCLUDED_HELP := 1

## Lists all available targets and any additional information about the project
help::
	@echo "----------------------------------------"
	@echo "[INFO] Available targets:"
	@echo "----------------------------------------"
	@awk 'BEGIN { FS=":.*" } \
	      /^[ ]*##/ { \
	          sub(/^[ ]*##[ ]?/, "", $$0); \
	          desc = $$0; next \
	      } \
	      /^[ ]*[^_][A-Za-z0-9_-]*:/ { \
	          tgt = $$1; \
	          gsub(/^[ ]*/, "", tgt); \
	          if (desc != "") { \
	              tmp = desc; gsub(/[# ]/, "", tmp); \
	              if (length(tmp) > 0) \
	                  printf "\033[36m%-20s\033[0m %s\n", tgt, desc; \
	          } \
	          desc = ""; \
	      }' $(MAKEFILE_LIST) | sort
	@echo "----------------------------------------"
	@echo
