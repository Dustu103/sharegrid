# Production — Nginx static file server
FROM nginx:1.27-alpine AS production
COPY . /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Remove default nginx config
RUN rm -f /etc/nginx/conf.d/default.conf.bak
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
