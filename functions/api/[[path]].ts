import { handleApi, type Environment } from "../../server/api";
export const onRequest = (context: { request: Request; env: Environment }) =>
  handleApi(context.request, context.env);
