import type { NewsItem, Statement } from "@novi/shared";
import { memberRequest } from "./client";

// D92: what moved in her groups lately, and her own payments line by line.
export const listNews = (limit = 30) => memberRequest<NewsItem[]>("GET", `/v1/me/news?limit=${limit}`);
export const getStatement = () => memberRequest<Statement>("GET", "/v1/me/statement");
// D157: she opened a notification kept in the app.
export const readNotice = (id: string) => memberRequest<void>("POST", `/v1/me/notices/${id}/read`);
