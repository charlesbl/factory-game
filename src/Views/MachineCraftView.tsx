import React from 'react'
import MachineCraft from '../Game/MachineCraft'
import IngredientsView from './IngredientsView'
import '../css/MachineCraft.css'

interface IMachineCraftProps {
    machineCraft: MachineCraft
    afordable: boolean
    onAdd: () => void
    onRemove: () => void
}

const MachineCraftView = (props: IMachineCraftProps): JSX.Element => {
    return <div className="machine-craft">
        <div className="name">{props.machineCraft.name}</div>
        <div className="wrapper">
            <IngredientsView ingredients={props.machineCraft.outputCraft.input} />
            <div>
                <div className="arrow"><i className="fas fa-arrow-right fa-10px"></i></div>
                <div>58%</div>
                <div className="btn-wrapper">
                    <button disabled={!props.afordable} onClick={() => props.onAdd()} className="btn btn-primary">+</button>
                    {props.machineCraft.isCustom && <button onClick={() => props.onRemove()} className="btn btn-danger"><i className="fas fa-trash fa-xs"></i></button>}
                </div>
            </div>
            <IngredientsView ingredients={props.machineCraft.outputCraft.output} />
        </div>
        <div>
            <IngredientsView ingredients={props.machineCraft.input} />
        </div>
    </div>
}
export default MachineCraftView
