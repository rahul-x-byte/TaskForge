FROM node:20-alpine
WORKDIR /app
COPY shared ./shared
COPY backend ./backend
RUN cd shared && npm install && npm run build
RUN cd backend && npm install && npm run build
EXPOSE 3001
CMD ["node", "backend/dist/index.js"]
