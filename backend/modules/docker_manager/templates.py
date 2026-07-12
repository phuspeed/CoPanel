"""Built-in compose templates for the Create Project gallery."""

from typing import Any, Dict, List

COMPOSE_TEMPLATES: List[Dict[str, Any]] = [
    {
        "id": "nginx",
        "name_en": "Nginx Web Server",
        "name_vi": "Nginx Web Server",
        "description_en": "Lightweight static file server on port 8080.",
        "description_vi": "Máy chủ web tĩnh nhẹ trên cổng 8080.",
        "icon": "Globe",
        "compose": """services:
  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "8080:80"
""",
    },
    {
        "id": "wordpress",
        "name_en": "WordPress + MariaDB",
        "name_vi": "WordPress + MariaDB",
        "description_en": "Blog stack with database volume persistence.",
        "description_vi": "Stack blog với database và volume lưu trữ.",
        "icon": "LayoutTemplate",
        "compose": """services:
  db:
    image: mariadb:10.11
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: changeme
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wordpress
      MYSQL_PASSWORD: changeme
    volumes:
      - db_data:/var/lib/mysql
  wordpress:
    image: wordpress:latest
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: changeme
      WORDPRESS_DB_NAME: wordpress
    volumes:
      - wp_data:/var/www/html
    depends_on:
      - db
volumes:
  db_data:
  wp_data:
""",
    },
    {
        "id": "mysql",
        "name_en": "MySQL Database",
        "name_vi": "MySQL Database",
        "description_en": "Standalone MySQL 8 on port 3306.",
        "description_vi": "MySQL 8 độc lập trên cổng 3306.",
        "icon": "Database",
        "compose": """services:
  mysql:
    image: mysql:8
    restart: unless-stopped
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: changeme
      MYSQL_DATABASE: app
    volumes:
      - mysql_data:/var/lib/mysql
volumes:
  mysql_data:
""",
    },
    {
        "id": "redis",
        "name_en": "Redis Cache",
        "name_vi": "Redis Cache",
        "description_en": "In-memory cache on port 6379.",
        "description_vi": "Bộ nhớ đệm Redis trên cổng 6379.",
        "icon": "Zap",
        "compose": """services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
""",
    },
    {
        "id": "node",
        "name_en": "Node.js App",
        "name_vi": "Ứng dụng Node.js",
        "description_en": "Sample Node service — replace image with your build.",
        "description_vi": "Dịch vụ Node mẫu — thay image bằng bản build của bạn.",
        "icon": "Boxes",
        "compose": """services:
  app:
    image: node:20-alpine
    restart: unless-stopped
    working_dir: /app
    command: sh -c "npm start"
    ports:
      - "3000:3000"
    volumes:
      - ./app:/app
""",
    },
]
