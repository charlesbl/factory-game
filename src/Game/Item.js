import Id from "./Id";

class Item extends Id{
    constructor(name) {
        super();
        this.name = name;
    }
    toString() {
        return this.name;
    }
}
export default Item;