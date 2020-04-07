class Id {
    constructor() {
        this.id = Id.incrementId();
    }

    static incrementId() {
        if (this.latestId === undefined)
            this.latestId = 0;
        else
            this.latestId++;
        return this.latestId;
    }
}
export default Id;