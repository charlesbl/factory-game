class Item {
    id: string;
    name: string;
    infinite: boolean;
    cost?: number;

    constructor(id: string, name: string, cost?: number, infinite: boolean = false) {
        this.id = id;
        this.name = name;
        this.infinite = infinite;
        this.cost = cost;
    }
}
export default Item;