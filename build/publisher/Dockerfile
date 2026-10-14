# =============================================================================
# The publish pipeline, as a container.
#
# BUILD CONTEXT IS build/, NOT build/publisher/. The image has to carry three
# packages, not one:
#
#   publisher/   this service
#   web/         the renderer. src/render.mjs runs `npm run build` HERE, as a
#                child process, rather than reimplementing the page. That is a
#                settled decision (see this package's README, section 11) and
#                it is the reason the image is large: an installed Next
#                dependency tree is a hard requirement of the render, not an
#                optimisation.
#   content/     read only. The placeholder guard reads its markers from the
#                content package rather than retyping them, and the build
#                renders its fixtures when no content API is configured.
#
# Build it from build/:
#
#   docker build -f publisher/Dockerfile -t trevean-publisher:local .
#
# WHY THE LAYOUT IS MIRRORED AT /srv/build. src/config.mjs resolves webDir,
# contentDir and renderDir relative to its own location: build/publisher/src ->
# build. Putting the three packages under /srv/build means every default in
# that file is already correct and nothing has to be re-stated as an
# environment variable that could drift from it.
#
# NO --omit=dev ON THE WEB PACKAGE, and it is not an oversight. `next build`
# needs typescript and @types at run time, `prebuild` needs sharp, and pruning
# to a hand written subset would be a second copy of that dependency list which
# would drift from package.json in exactly the places nobody is looking. The
# cost is image size. The cost of the alternative is a build that fails on the
# first day somebody adds a dev dependency the build needs.
# =============================================================================

FROM node:22-bookworm-slim

# tini, because this process spawns npm which spawns next, and a container
# whose PID 1 does not reap children accumulates zombies across publishes.
# ca-certificates, because the render reads the content API over HTTPS.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

WORKDIR /srv/build

# ---------------------------------------------------------------------------
# Dependencies first, sources second, so an edit to a page does not reinstall
# 551 MB of node_modules.
#
# npm ci and not npm install: the lockfile is the dependency list, and a build
# that resolves versions afresh is a build that can ship something the licence
# manifest does not name. See MANIFEST.md in this directory.
# ---------------------------------------------------------------------------

COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --include=dev

COPY publisher/package.json publisher/package-lock.json ./publisher/
RUN cd publisher && npm ci --omit=dev

COPY content/ ./content/
COPY web/ ./web/

# ---------------------------------------------------------------------------
# Render once at image build time.
#
# This is what makes the FIRST publish after a task replacement the same shape
# as every other one. Without it the first publish also pays for generating the
# image derivatives from the masters in the content package, which is sharp
# work that has nothing to do with the edit that triggered it.
#
# It renders the content package fixtures, never the API, because an image is
# built long before it is deployed and a snapshot of somebody's content baked
# into an image is a stale page waiting to be published by accident. The
# publish path re-renders against TREVEAN_CONTENT_API on every job.
# ---------------------------------------------------------------------------
RUN cd web && npm run build

# The publisher's own sources come AFTER the render, deliberately. They are the
# ones that change most often and the render is the slowest layer in this file
# by two orders of magnitude, so copying them earlier would mean re-rendering
# every page to fix a log message.
COPY publisher/ ./publisher/

WORKDIR /srv/build/publisher

# Not root. The render writes .next, out, public/media and .content-snapshot
# under /srv/build/web, so that tree has to be writable by this user and
# nothing else does.
RUN chown -R node:node /srv/build/web
USER node

# STAGE is deliberately NOT defaulted here. src/config.mjs falls back to
# 'local' when it is unset, and 'local' is the value the placeholder deployment
# guard treats as non production. A container image that carries a default
# stage is an image that decides that guard's answer, so the task definition
# sets it and an unrecognised value refuses to start.
ENV PUBLISHER_HOST=0.0.0.0 \
    PUBLISHER_PORT=3003 \
    PUBLISHER_RENDER_MODE=build

EXPOSE 3003

# The health check the load balancer target group also uses. Node's own fetch,
# because adding curl to the image to check a Node server is a second thing to
# patch for no gain.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PUBLISHER_PORT||3003)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.mjs"]
