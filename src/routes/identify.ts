import { Router } from "express";
import { identify } from "../controllers/identify.controller";

export const identifyRouter = Router();

identifyRouter.post("/", identify);
