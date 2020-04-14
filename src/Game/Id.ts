class Id {
    static latestId: number;
    id: number;

    constructor() {
        this.id = Id.incrementId();
    }

    static incrementId() : number {
        if (this.latestId === undefined)
            this.latestId = 0;
        else
            this.latestId++;
        return this.latestId;
    }
}
export default Id;