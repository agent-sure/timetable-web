# Timetable Web

一个纯前端的课程表查看器：支持 W1–W16 周次切换、搜索、点击查看课程详情。

## 使用

```bash
cd timetable-web
python3 -m http.server 8000
```

然后浏览器打开：

- http://localhost:8000

## 数据格式

编辑 `schedule.json`：

- `slots`: 节次与时间
- `events`: 课程块

`weeks` 字段支持：

- `W12`
- `W9-16`
- `W1,3,5`
- `W1-6;W9-10`

> 目前我对截图的“按眼读”解析不完整，你可以把两张图里所有课程都补进 `events`，页面会自动按周过滤显示。
