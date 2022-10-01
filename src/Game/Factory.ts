import Machine from './Machine'
import Craft from './Craft'
import MachineCraft from './MachineCraft'
import Ingredient from './Ingredient'

const DEFAULT_NAME = 'New Factory'

export default class Factory {
    private _machines: Machine[]
    private _factories: Factory[]
    private _inputs: Ingredient[]
    private _outputs: Ingredient[]
    private topFactory?: Factory
    private _name: string

    public get machines (): Machine[] {
        return this._machines
    }

    public get factories (): Factory[] {
        return this._factories
    }

    public get name (): string {
        return this._name
    }

    public set name (value: string) {
        this._name = value
    }

    public constructor (machines?: Machine[], factories?: Factory[], topFactory?: Factory) {
        if (machines !== undefined) {
            this._machines = machines
        } else {
            this._machines = []
        }

        if (factories !== undefined) {
            this._factories = factories
        } else {
            this._factories = []
        }
        this._inputs = []
        this._outputs = []
        this._name = DEFAULT_NAME

        this.topFactory = topFactory
        this.updateInputsAndOutputs()
    }

    public togglePauseMachine (machine: Machine): void {
        machine.active = !machine.active
        this.updateInputsAndOutputs()
    }

    public setTopFactory (factory: Factory): void {
        this.topFactory = factory
    }

    public addSubFactory (): void {
        this._factories.push(new Factory(undefined, undefined, this))
        this.updateInputsAndOutputs()
    }

    public buildMachine (machineCraft: MachineCraft): Machine {
        const machine = new Machine(machineCraft.name, machineCraft.outputCraft)
        this._machines.push(machine)
        this.updateInputsAndOutputs()
        return machine
    }

    public destroyMachine (machine: Machine): void {
        this._machines = this._machines.filter((elem) => {
            return elem !== machine
        })
        this.updateInputsAndOutputs()
    }

    public getMachinesOfType (machineCraft: Craft): Machine[] {
        return this._machines.filter((machine) => machine.craft.id === machineCraft.id)
    }

    public destroySubFactory (subFactory: Factory): void {
        subFactory._machines.forEach((machine) => subFactory.destroyMachine(machine))
        subFactory._factories.forEach((factory) => subFactory.destroySubFactory(factory))
        this._factories = this._factories.filter((elem) => {
            return elem !== subFactory
        })
        this.updateInputsAndOutputs()
    }

    public updateInputsAndOutputs (): void {
        const allInputs: Ingredient[] = []
        allInputs.push(...this._machines.filter((machine) => machine.active).map((machine) => machine.craft.input).flat())
        allInputs.push(...this._factories.map((factory) => factory.inputs).flat())
        const mergedInputs = Ingredient.mergeIngredient(allInputs)

        const allOutputs: Ingredient[] = []
        allOutputs.push(...this._machines.filter((machine) => machine.active).map((machine) => machine.craft.output).flat())
        allOutputs.push(...this._factories.map((factory) => factory.outputs).flat())
        const mergedOutputs = Ingredient.mergeIngredient(allOutputs)

        const [simplifiedInputs, simplifiedOutputs] = Ingredient.simplifyIngredient(mergedInputs, mergedOutputs)
        this._inputs = simplifiedInputs
        this._outputs = simplifiedOutputs
        this.topFactory?.updateInputsAndOutputs()
        console.log('update f')
    }

    public setAllMachineActive (value: boolean): void {
        this._machines.forEach((machine) => { machine.active = value })
        this._factories.forEach((factory) => {
            factory.setAllMachineActive(value)
        })
        this.updateInputsAndOutputs()
    }

    public get inputs (): Ingredient[] {
        return this._inputs
    }

    public get outputs (): Ingredient[] {
        return this._outputs
    }
}
