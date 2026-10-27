#!/usr/bin/env bash
# Runs the checks of .github/workflows/ci.yml on this machine, in the same order, so a change can
# be tested before it is pushed. Stops at the first failing step.
#
#   scripts/ci-local.sh           every check except the SonarQube analysis
#   scripts/ci-local.sh --sonar   also the analysis, through Docker (needs SONAR_TOKEN in the shell)
#
# Differences from CI: the local Supabase stack and the .env are reused when they already exist,
# so the stack is not booted from scratch each time (`npx supabase stop` resets it). Docker keeps
# the images it pulled, so they are not pulled again. The e2e tests are not part of CI and not run.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

sonar=false
for arg in "$@"; do
  case "$arg" in
    --sonar) sonar=true ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

step() {
  echo
  echo "==> $*"
  local start=$SECONDS
  "$@"
  echo "    done in $((SECONDS - start))s"
}

step npm ci --ignore-scripts --no-audit --no-fund
step npm run format:check
step npm run lint
step npm run typecheck
step npm run build
step npm run setup:local
step npm run db:migrate
step npm run test:coverage

if [ "$sonar" = true ]; then
  if [ -z "${SONAR_TOKEN:-}" ]; then
    echo "--sonar needs SONAR_TOKEN in the shell. Set it, then rerun." >&2
    exit 2
  fi
  # Same properties file as CI. Locally it analyzes the current branch and does not decorate the
  # pull request. SONAR_HOST_URL defaults to SonarCloud, as in CI.
  organization=()
  if [ -n "${SONAR_ORGANIZATION:-}" ]; then
    organization=("-Dsonar.organization=$SONAR_ORGANIZATION")
  fi
  step docker run --rm \
    -v "$PWD:/usr/src" \
    -e SONAR_TOKEN \
    -e SONAR_HOST_URL="${SONAR_HOST_URL:-https://sonarcloud.io}" \
    sonarsource/sonar-scanner-cli "${organization[@]}"
fi

echo
echo "All local CI checks passed."
