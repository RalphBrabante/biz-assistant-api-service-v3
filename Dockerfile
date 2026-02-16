FROM node:20-bookworm-slim

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --no-audit --fund=false

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
