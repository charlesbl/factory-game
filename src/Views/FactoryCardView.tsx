import React, { useState } from 'react'
import '../css/FactoryCardView.css'
import Factory from '../Game/Factory'
import IngredientsView from './IngredientsView'

interface IFactoryProps {
    factory: Factory
    onClickEnter: () => void
    onDeleteFactory: () => void
    onCreateCustomMachine: () => void
}

const FactoryCardView = (props: IFactoryProps): JSX.Element => {
    const [isEditTitle, setIsEditTitle] = useState(false)

    const handleTitleChange = (e: React.FocusEvent<HTMLInputElement>): void => {
        setIsEditTitle(false)
        props.factory.name = e.target.value
    }

    return (
        <div className="factory">
            <div className="factory-header">
                {isEditTitle
                    ? <input autoFocus={true} onBlur={handleTitleChange} defaultValue={props.factory.name} />
                    : <>
                        <div className="name">{props.factory.name}</div>
                        <button className="btn btn-primary btn-modify" onClick={() => setIsEditTitle(true)}><i className="fas fa-edit fa-xs"></i></button>
                    </>}

            </div>

            <div className="factory-wrapper">
                <IngredientsView ingredients={props.factory.inputs} />
                <div>
                    <div className="arrow"><i className="fas fa-arrow-right fa-10px"></i></div>
                    <div className="fbtn-wrapper">
                        <button className="btn btn-primary" onClick={() => props.onClickEnter()}>Enter</button>
                        <button className="btn btn-primary" onClick={() => props.factory.setAllMachineActive(true)}>On</button>
                        <button className="btn btn-primary" onClick={() => props.factory.setAllMachineActive(false)}>Off</button>
                        <button className="btn btn-primary" onClick={() => props.onCreateCustomMachine()}>Create custom machine</button>
                        <button className="btn btn-danger btn-destroy" onClick={() => props.onDeleteFactory()}><i className="fas fa-trash fa-xs"></i></button>
                    </div>
                </div>
                <IngredientsView ingredients={props.factory.outputs} />
            </div>
        </div>
    )
}

export default FactoryCardView
