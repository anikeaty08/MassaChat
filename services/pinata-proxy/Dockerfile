FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY src ./src

ENV NODE_ENV=production
EXPOSE 4001

CMD ["npm", "start"]



