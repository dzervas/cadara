FROM oven/bun:1.4.3

WORKDIR /app

COPY package.json bun.lock ./
# prepare builds dist/contracts for git-dependency consumers; it needs the
# sources copied below and the dev server does not use its output.
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .

EXPOSE 3000

CMD ["bun", "run", "dev", "--host", "0.0.0.0", "--port", "3000"]
