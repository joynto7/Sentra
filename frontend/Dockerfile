FROM node:22.23.2-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Development server with live reload (used by docker compose).
FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:8000/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

# Small production image (Next.js standalone output).
FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S sentra && adduser -S sentra -G sentra
COPY --from=build /app/public ./public
COPY --from=build --chown=sentra:sentra /app/.next/standalone ./
COPY --from=build --chown=sentra:sentra /app/.next/static ./.next/static
USER sentra
EXPOSE 3000
CMD ["node", "server.js"]
