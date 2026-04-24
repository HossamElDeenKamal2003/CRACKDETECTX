const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');

// ── Buildings
const bRouter = express.Router();
const bCtrl   = require('../controllers/building.controller');
const { uploadBuilding } = require('../config/cloudinary');
bRouter.use(authenticate);
bRouter.post('/',      uploadBuilding.array('images', 10), bCtrl.createBuilding);
bRouter.get('/',       bCtrl.getBuildings);
bRouter.get('/:id',    bCtrl.getBuilding);
bRouter.put('/:id',    bCtrl.updateBuilding);
bRouter.delete('/:id', bCtrl.deleteBuilding);

// ── Scans
const sRouter = express.Router();
const sCtrl   = require('../controllers/scan.controller');
const { uploadScan } = require('../config/cloudinary');
sRouter.use(authenticate);
sRouter.post('/',                uploadScan.array('images', 20), sCtrl.createScan);
sRouter.post('/sync-draft',      sCtrl.syncDraft);
sRouter.get('/',                 sCtrl.getScans);
sRouter.get('/:id',              sCtrl.getScan);
sRouter.get('/:id/status',       sCtrl.getScanStatus);
sRouter.post('/:id/cancel',      sCtrl.cancelScan);
sRouter.get('/:id/annotations',  sCtrl.getAnnotations);
sRouter.post('/:id/annotations', sCtrl.saveAnnotation);

// ── Reports
const rRouter = express.Router();
const rCtrl   = require('../controllers/report.controller');
rRouter.get('/shared/:token', rCtrl.viewSharedReport);
rRouter.use(authenticate);
rRouter.get('/',                         rCtrl.getUserReports);
rRouter.get('/scan/:scanId',             rCtrl.getReportByScan);
rRouter.post('/scan/:scanId/regenerate', rCtrl.regenerateReport);
rRouter.get('/:id',                      rCtrl.getReport);
rRouter.post('/:id/share',               rCtrl.shareReport);

// ── Marketplace
const mRouter = express.Router();
const mCtrl   = require('../controllers/marketplace.controller');
mRouter.use(authenticate);
mRouter.get('/engineers',                 mCtrl.getEngineers);
mRouter.get('/requests',                  mCtrl.getRequests);
mRouter.get('/requests/mine',             mCtrl.getMyRequests);
mRouter.post('/requests',                 mCtrl.createRequest);
mRouter.get('/requests/:id',              mCtrl.getRequest);
mRouter.post('/requests/:requestId/bids', mCtrl.submitBid);
mRouter.post('/bids/:bidId/accept',       mCtrl.acceptBid);
mRouter.get('/contracts',                 mCtrl.getContracts);

// ── Notifications
const nRouter = express.Router();
const nCtrl   = require('../controllers/notification.controller');
nRouter.use(authenticate);
nRouter.get('/',            nCtrl.getNotifications);
nRouter.get('/unread',      nCtrl.getUnreadCount);
nRouter.post('/read',       nCtrl.markRead);
nRouter.post('/push-token', nCtrl.registerPushToken);

// ── Support
const supRouter = express.Router();
const supCtrl   = require('../controllers/support.controller');
supRouter.use(authenticate);
supRouter.post('/',   supCtrl.createTicket);
supRouter.get('/',    supCtrl.getMyTickets);
supRouter.get('/:id', supCtrl.getTicket);

// ── Drafts
const dRouter = express.Router();
const dCtrl   = require('../controllers/draft.controller');
dRouter.use(authenticate);
dRouter.post('/',       dCtrl.saveDraft);
dRouter.get('/',        dCtrl.getDrafts);
dRouter.get('/pending', dCtrl.syncPendingDrafts);
dRouter.delete('/:id',  dCtrl.deleteDraft);

// ── Admin
const aRouter = express.Router();
const aCtrl   = require('../controllers/admin.controller');
aRouter.use(authenticate, authorize('admin'));
aRouter.get('/dashboard',              aCtrl.getDashboard);
aRouter.get('/users',                  aCtrl.getUsers);
aRouter.patch('/users/:userId/status', aCtrl.toggleUserStatus);
aRouter.get('/audit-logs',             aCtrl.getAuditLogs);
aRouter.get('/tickets',                aCtrl.getTickets);
aRouter.patch('/tickets/:id',          aCtrl.updateTicket);

module.exports = {
  buildingsRouter:     bRouter,
  scansRouter:         sRouter,
  reportsRouter:       rRouter,
  marketplaceRouter:   mRouter,
  notificationsRouter: nRouter,
  supportRouter:       supRouter,
  draftsRouter:        dRouter,
  adminRouter:         aRouter,
};