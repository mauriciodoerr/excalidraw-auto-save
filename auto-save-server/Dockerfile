FROM node:20-alpine

# git is needed for commit/push operations
RUN apk add --no-cache git openssh-client

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./

EXPOSE 3001

CMD ["node", "server.js"]
