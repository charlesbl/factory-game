import Game from './Game'
import ItemStack, { IItemStackSave } from './ItemStack'
import Item from './Item';
import Factory from './Factory';

export interface IInventorySave {
    itemStacks: { [key: string]: IItemStackSave }
}

export default class Inventory {
    itemStacks: { [key: string]: ItemStack }
    factory?: Factory;
    constructor(factory?: Factory) {
        this.factory = factory;
        this.itemStacks = {};
        Game.items.forEach((item: Item) => {
            this.itemStacks[item.id] = new ItemStack(item, 0);
        });
    }

    getSave(): IInventorySave {
        var result: { [key: string]: IItemStackSave } = {};
        Object.entries(this.itemStacks).forEach(([id, itemStack]) => result[id] = itemStack.getSave());
        return {
            itemStacks: result
        }
    }

    static fromSave(save: IInventorySave, factory: Factory) {
        var inventory = new Inventory(factory);
        Object.entries(save.itemStacks).forEach(([id, itemStackSave]) => {
            inventory.add(ItemStack.fromSave(itemStackSave));
            inventory.itemStacks[itemStackSave.itemId].exchangeDirection = itemStackSave.exchangeDirection;
        });
        return inventory;
    }

    getItemStackList() {
        return Object.entries(this.itemStacks).map(([id, itemStack]) => itemStack);
    }

    remove(itemStack: ItemStack, count: number = 1) {
        this.itemStacks[itemStack.item.id].quantity -= itemStack.quantity * count;
    }

    add(itemStack: ItemStack, count: number = 1) {
        this.itemStacks[itemStack.item.id].quantity += itemStack.quantity * count;
    }

    addItem(item: Item, count: number = 1) {
        this.itemStacks[item.id].quantity += count;
    }

    removeItem(item: Item, count: number = 1): boolean {
        if (this.itemStacks[item.id].quantity - count >= 0) {
            this.itemStacks[item.id].quantity -= count;
            return true;
        } else {
            return false;
        }
    }

    contains(itemStack: ItemStack) {
        return this.itemStacks[itemStack.item.id].quantity >= itemStack.quantity;
    }

    getQuantity(item: Item) {
        return this.itemStacks[item.id].quantity;
    }

    addInventory(inventory: Inventory, count: number = 1) {
        for (let i = 0; i < count; i++) {
            inventory.getItemStackList().forEach((itemStack) => this.add(itemStack));
        }
    }

    removeInventory(inventory: Inventory, count: number = 1) {
        for (let i = 0; i < count; i++) {
            inventory.getItemStackList().forEach((itemStack) => this.remove(itemStack));
        }
    }
}