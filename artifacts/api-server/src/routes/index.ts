import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import healthRouter from "./health";
import invoicesRouter from "./invoices";
import settingsRouter from "./settings";
import dropboxOAuthRouter from "./dropbox-oauth";
import lieferantenRouter from "./lieferanten";
import buchungskontenRouter from "./buchungskonten";

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireAuth);
router.use(invoicesRouter);
router.use(settingsRouter);
router.use(dropboxOAuthRouter);
router.use(lieferantenRouter);
router.use(buchungskontenRouter);

export default router;
