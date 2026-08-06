FROM node:20-alpine
WORKDIR /app
COPY frontend ./frontend
RUN cd frontend && npm install && npm run build
EXPOSE 5173
CMD ["npm", "--prefix", "frontend", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]
