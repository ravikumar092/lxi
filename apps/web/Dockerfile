# Build stage
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Production stage
FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Add custom nginx config if needed, otherwise default is fine for simple SPA
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
