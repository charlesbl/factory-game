class Item {
    constructor(name) {
        this.name = name;
        this.id = Item.incrementId();
    }
    toString() {
        return this.name;
    }

    static incrementId() {
        if (typeof this.latestId === 'undefined') 
            this.latestId = 0;
        else 
            this.latestId++;
        return this.latestId;
    }
}
export default Item;