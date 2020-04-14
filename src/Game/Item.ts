class Item {
    id: string;
    name: string;
    infinite: boolean;
    
    constructor(id: string, name: string, infinite: boolean = false) {
        this.id = id;
        this.name = name;
        this.infinite = infinite;
    }
}
export default Item;