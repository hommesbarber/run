FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.html server.cjs protocol.cjs replay.cjs ./
USER node
EXPOSE 8080
CMD ["node", "server.cjs"]
