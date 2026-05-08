FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY server.js db.js ./
COPY --from=build /app/dist ./dist
EXPOSE 7400
ENV NODE_ENV=production
ENV DATA_DIR=/data
VOLUME ["/data"]
CMD ["node", "server.js"]
