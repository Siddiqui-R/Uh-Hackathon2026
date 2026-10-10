FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci
COPY apps/web ./apps/web
EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace", "@htx/web", "--", "--hostname", "0.0.0.0"]
