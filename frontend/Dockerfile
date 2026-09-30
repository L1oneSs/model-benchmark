# --- сборка ---
FROM node:22.12-alpine AS build

ARG VITE_API_BASE_URL=http://localhost:8000
ARG VITE_MODEL_SOURCE=cdn
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_MODEL_SOURCE=$VITE_MODEL_SOURCE

WORKDIR /app

COPY package.json ./
RUN ONNXRUNTIME_NODE_INSTALL=skip npm install --legacy-peer-deps

COPY tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

# Бинарники WebAssembly-бэкенда TensorFlow.js раздаются самим стендом
RUN mkdir -p public/wasm && cp node_modules/@tensorflow/tfjs-backend-wasm/dist/*.wasm public/wasm/

RUN npm run build

# --- раздача ---
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
