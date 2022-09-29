import Ingredient from './Ingredient'

class Craft {
    public readonly id: string
    public readonly name: string
    public readonly input: Ingredient[]
    public readonly output: Ingredient[]
    public readonly duration: number

    constructor (id: string, name: string, input: Ingredient[], output: Ingredient[], duration: number) {
        this.id = id
        this.name = name
        this.input = input
        this.output = output
        this.duration = duration
    }
}
export default Craft
