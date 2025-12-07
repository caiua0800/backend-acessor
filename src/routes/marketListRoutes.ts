import { Router } from 'express';
import * as controller from '../controllers/marketListController';

const router = Router();

// Define as rotas e associa cada uma a uma função do controller

// GET /market-list/
// Rota para buscar a lista de compras completa do usuário
router.get('/', controller.get);

// POST /market-list/add
// Rota para adicionar um novo item à lista
router.post('/add', controller.add);

// PUT /market-list/:itemId
// Rota para atualizar a quantidade de um item específico (passando o ID na URL)
router.put('/:itemId', controller.update);

// DELETE /market-list/clear
// Rota para apagar todos os itens da lista de uma vez
router.delete('/clear', controller.clear);

// DELETE /market-list/:itemId
// Rota para remover um item específico da lista (passando o ID na URL)
router.delete('/:itemId', controller.remove);

export default router;