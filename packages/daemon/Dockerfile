FROM node:22-alpine

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY dist/ dist/

CMD ["node", "dist/index.js"]
