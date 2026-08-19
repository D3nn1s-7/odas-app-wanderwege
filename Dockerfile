FROM nginx:1.25.2-alpine

COPY ./app /usr/share/nginx/html/app
COPY ./assets /usr/share/nginx/html/assets
COPY ./nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
