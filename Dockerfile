FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

EXPOSE 7400

ENV NODE_ENV=production
ENV DATA_DIR=/data

VOLUME ["/data"]

CMD ["node", "server.js"]
