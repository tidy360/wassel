import { createApp } from "./app";

const app = createApp();
const port = Number(process.env.PORT) || 4000;

app.listen(port, () => {
  console.log(`Cashiri API listening on port ${port}`);
});
