# 需要环境

1. ffmpeg
2. nodejs

# 使用

```bash
pnpm install
pnpm run compile
pnpm run start
```

npm应该也可以，但没测试

# 问题
在爬取的过程中有时候会卡住，原因不明，重新运行`pnpm run start`也许可以解决问题

# 说明
可以将根目录的md.css设置为vscode的预览样式，也可自行设置其他样式

# 功能
爬取nhk easy new的新闻文本及音频，默认是爬今天和昨天的新闻，修改`const days = 1`中的数字可以对饮获取多少天的新闻，数字X(`1<X<5`)