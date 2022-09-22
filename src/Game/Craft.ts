import ItemStack from "./ItemStack";
import Factory from "./Factory";
import Game from "./Game";

class Craft {
    id: string;
    name: string;
    input: ItemStack[];
    output: ItemStack[];
    duration: number;
    cost: number;

    constructor(id: string, name: string, input: ItemStack[], output: ItemStack[], duration: number) {
        this.id = id;
        this.name = name;
        this.input = input;
        this.output = output;
        this.duration = duration;
        this.cost = this.getCost();
    }

    canCraft(factory: Factory) {
        return this.input.every(itemStack => {
            return factory.inventory.contains(itemStack);
        });
    }

    consume(factory: Factory) {
        this.input.forEach(itemStack => {
            factory.inventory.remove(itemStack);
        });
    }

    produce(factory: Factory) {
        this.output.forEach(itemStack => {
            factory.inventory.add(itemStack);
        });
    }

    simpleCraft(factory: Factory) {
        this.craft(factory, factory);
    }

    craft(consumeFactory: Factory, produceFactory: Factory) {
        this.consume(consumeFactory);
        this.produce(produceFactory);
    }

    simpleTryCraft(factory: Factory) {
        if (this.canCraft(factory)) {
            this.simpleCraft(factory);
            return true;
        } else {
            return false;
        }
    }

    tryCraft(consumeFactory: Factory, produceFactory: Factory) {
        if (this.canCraft(consumeFactory)) {
            this.craft(consumeFactory, produceFactory);
            return true;
        } else {
            return false;
        }
    }

    getCost(): number {
        var cost = 0;
        this.input.forEach((itemStack) => {
            cost += itemStack.item.getBuyPrice() * itemStack.quantity;
        });
        return cost;
    }

    tryBuy(produceFactory: Factory, game: Game) {
        if (game.money >= this.cost) {
            this.produce(produceFactory);
            game.money -= this.cost;
        }
    }

    canBuy(game: Game) {
        return game.money >= this.cost
    }

}
export default Craft;